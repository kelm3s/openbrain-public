import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const MODEL_ID = 'amazon.titan-embed-text-v2:0';
const DIMENSIONS = 1024; // Titan Embed Text v2 max (v1 was 1536, v2 supports 256/512/1024)

// Generate a 1024-dimension vector embedding for the given text
export async function generateEmbedding(text: string): Promise<number[]> {
  const payload = { inputText: text, dimensions: DIMENSIONS, normalize: true };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload)
  });

  const response = await client.send(command);
  const body = JSON.parse(Buffer.from(response.body).toString('utf-8'));

  if (!body.embedding || !Array.isArray(body.embedding)) {
    throw new Error('Bedrock returned unexpected embedding format');
  }

  return body.embedding as number[];
}

// Format a JS number[] as a pgvector-compatible string: '[0.1, 0.2, ...]'
export function formatVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
