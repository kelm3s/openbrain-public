# SETUP.md — Build Your Own OpenBrain

Step-by-step guide to deploy OpenBrain on your own AWS account.

**Prerequisites:** AWS account, AWS CLI configured, Node.js 18+, Git

> ⚠️ **Set up an AWS Budgets alert ($5/month) before creating any resources.**  
> AWS Console → Billing → Budgets → Create budget → Monthly cost budget.

---

## Step 1 — AWS Setup

### 1a. Create the Lambda IAM role

```bash
aws iam create-role \
  --role-name openbrain-lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
```

Attach the inline policy from `infra/iam-policy.json` — replace `YOUR_ACCOUNT_ID` and `YOUR_SECRET_ARN` first (you'll get the secret ARN after Step 2):

```bash
aws iam put-role-policy \
  --role-name openbrain-lambda-role \
  --policy-name openbrain-lambda-policy \
  --policy-document file://infra/iam-policy.json
```

### 1b. Store your brain key in SSM Parameter Store

Generate a random key and store it:

```bash
# Generate a key (any random string works)
openssl rand -hex 32

# Store it
aws ssm put-parameter \
  --name "/openbrain/brain-key" \
  --value "YOUR_GENERATED_KEY" \
  --type SecureString \
  --region us-east-1
```

### 1c. Bedrock model access

Titan Embed Text v2 is auto-enabled on first invocation on most accounts. No manual action needed.

---

## Step 2 — Aurora Serverless v2

### 2a. Create the cluster

```bash
aws rds create-db-cluster \
  --db-cluster-identifier openbrain-cluster \
  --engine aurora-postgresql \
  --engine-version 16.4 \
  --serverless-v2-scaling-configuration MinCapacity=0,MaxCapacity=1 \
  --enable-http-endpoint \
  --manage-master-user-password \
  --master-username postgres \
  --region us-east-1
```

Wait for the cluster to become available (~3–5 minutes):

```bash
aws rds wait db-cluster-available --db-cluster-identifier openbrain-cluster --region us-east-1
```

### 2b. Get the secret ARN

```bash
aws rds describe-db-clusters \
  --db-cluster-identifier openbrain-cluster \
  --query 'DBClusters[0].MasterUserSecret.SecretArn' \
  --output text \
  --region us-east-1
```

Update `infra/iam-policy.json` with the real secret ARN, then re-attach the policy (Step 1a).

> **Note:** The secret ARN contains `rds!cluster-...` with an `!`. When passing it in bash, use single-quoted `--cli-input-json` to avoid history expansion.

### 2c. Run the schema

Open the AWS Console → **RDS → Query Editor** → connect to `openbrain-cluster` using the Secrets Manager secret, then run `infra/schema.sql`.

Or via CLI:

```bash
CLUSTER_ARN=$(aws rds describe-db-clusters --db-cluster-identifier openbrain-cluster --query 'DBClusters[0].DBClusterArn' --output text --region us-east-1)
SECRET_ARN=$(aws rds describe-db-clusters --db-cluster-identifier openbrain-cluster --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text --region us-east-1)

aws rds-data execute-statement --cli-input-json "{
  \"resourceArn\": \"$CLUSTER_ARN\",
  \"secretArn\": \"$SECRET_ARN\",
  \"database\": \"postgres\",
  \"sql\": \"CREATE EXTENSION IF NOT EXISTS vector; CREATE TABLE IF NOT EXISTS thoughts (id BIGSERIAL PRIMARY KEY, content TEXT NOT NULL, embedding vector(1024), source VARCHAR(50), tags TEXT[], created_at TIMESTAMPTZ DEFAULT NOW()); CREATE INDEX IF NOT EXISTS thoughts_embedding_idx ON thoughts USING hnsw (embedding vector_cosine_ops);\"
}" --region us-east-1
```

---

## Step 3 — Lambda Function

### 3a. Build

```bash
cd lambda
npm install
npm run build   # tsc → dist/
```

### 3b. Package

```bash
# Linux/Mac
zip -r ../openbrain.zip dist/ node_modules/ package.json

# Windows PowerShell
Compress-Archive -Path dist,node_modules,package.json -DestinationPath ..\openbrain.zip -Force
```

### 3c. Deploy

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CLUSTER_ARN=$(aws rds describe-db-clusters --db-cluster-identifier openbrain-cluster --query 'DBClusters[0].DBClusterArn' --output text --region us-east-1)
SECRET_ARN=$(aws rds describe-db-clusters --db-cluster-identifier openbrain-cluster --query 'DBClusters[0].MasterUserSecret.SecretArn' --output text --region us-east-1)

aws lambda create-function \
  --function-name openbrain \
  --runtime nodejs22.x \
  --architectures arm64 \
  --role arn:aws:iam::${ACCOUNT_ID}:role/openbrain-lambda-role \
  --handler dist/index.handler \
  --zip-file fileb://../openbrain.zip \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={AURORA_CLUSTER_ARN=${CLUSTER_ARN},AURORA_SECRET_ARN=${SECRET_ARN},AURORA_DATABASE=postgres,AWS_REGION_OVERRIDE=us-east-1}" \
  --region us-east-1
```

To redeploy after code changes:

```bash
# Linux/Mac
npm run build && \
zip -r ../openbrain.zip dist/ node_modules/ package.json && \
aws lambda update-function-code --function-name openbrain --zip-file fileb://../openbrain.zip --region us-east-1
```

```powershell
# Windows PowerShell
npm run build
Compress-Archive -Path dist,node_modules,package.json -DestinationPath ..\openbrain.zip -Force
aws lambda update-function-code --function-name openbrain --zip-file fileb://../openbrain.zip --region us-east-1
```

---

## Step 4 — API Gateway HTTP API

### 4a. Create the API

```bash
API_ID=$(aws apigatewayv2 create-api \
  --name openbrain-api \
  --protocol-type HTTP \
  --query ApiId --output text \
  --region us-east-1)

echo "API ID: $API_ID"
```

### 4b. Create Lambda integration

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
LAMBDA_ARN=arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:openbrain

INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri $LAMBDA_ARN \
  --payload-format-version 2.0 \
  --query IntegrationId --output text \
  --region us-east-1)
```

### 4c. Create route and deploy

```bash
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key "ANY /mcp" \
  --target integrations/$INTEGRATION_ID \
  --region us-east-1

aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy \
  --region us-east-1
```

### 4d. Grant API Gateway permission to invoke Lambda

```bash
aws lambda add-permission \
  --function-name openbrain \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:${ACCOUNT_ID}:${API_ID}/*/*/mcp" \
  --region us-east-1
```

Your endpoint is: `https://${API_ID}.execute-api.us-east-1.amazonaws.com/mcp`

> **Note:** Lambda Function URLs have account-level Block Public Access enabled by default on new accounts (since late 2024). Use API Gateway instead — same free tier cost, no friction.

---

## Step 5 — Test End-to-End

```bash
curl -X POST https://YOUR_ID.execute-api.us-east-1.amazonaws.com/mcp \
  -H "x-brain-key: YOUR_BRAIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should get back the 4 tools: `capture_thought`, `search_thoughts`, `browse_recent`, `get_stats`.

---

## Step 6 — Connect Your MCP Client

See [docs/mcp-config.md](docs/mcp-config.md) for full configuration for:
- VS Code (GitHub Copilot)
- Claude Desktop (Windows)
- Claude Desktop (Mac — Homebrew and nvm)
- Claude Code (CLI)

The proxy is published to npm — no repo clone needed on client machines:

```bash
npx openbrain-proxy
```

---

## Optional: Security Hardening

- **API Gateway throttling:** Set to 5 req/sec sustained, burst 10
  ```bash
  aws apigatewayv2 update-stage --api-id $API_ID --stage-name '$default' \
    --default-route-settings 'ThrottlingBurstLimit=10,ThrottlingRateLimit=5' --region us-east-1
  ```
- **CloudWatch log retention:** Set to 90 days instead of infinite
  ```bash
  MSYS_NO_PATHCONV=1 aws logs put-retention-policy \
    --log-group-name /aws/lambda/openbrain --retention-in-days 90 --region us-east-1
  ```
- **Aurora deletion protection:**
  ```bash
  aws rds modify-db-cluster --db-cluster-identifier openbrain-cluster \
    --deletion-protection --apply-immediately --region us-east-1
  ```
