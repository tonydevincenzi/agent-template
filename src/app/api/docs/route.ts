import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const agentConfig = JSON.parse(process.env.AGENT_CONFIG || '{}');
    const deployUrl = request.nextUrl.origin;

    const docs = {
      name: agentConfig.name || 'Agent',
      description: agentConfig.systemPrompt || 'AI Agent',
      model: agentConfig.model || 'claude-haiku-4-5-20251001',
      version: '1.0.0',
      endpoint: {
        url: `${deployUrl}/api/chat`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          message: 'string (required) - Your message to the agent',
          messages: 'array (optional) - Full message history in Anthropic format'
        },
        response: {
          message: 'string - The agent\'s response',
          agent: 'string - Agent name',
          model: 'string - Model used',
          usage: {
            input_tokens: 'number',
            output_tokens: 'number'
          }
        }
      },
      examples: {
        curl: `curl -X POST ${deployUrl}/api/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello!"}'`,
        javascript: `const response = await fetch('${deployUrl}/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello!' })
});
const data = await response.json();
console.log(data.message);`,
        python: `import requests

response = requests.post('${deployUrl}/api/chat',
  json={'message': 'Hello!'})
data = response.json()
print(data['message'])`
      },
      configuration: {
        systemPrompt: agentConfig.systemPrompt,
        tools: agentConfig.tools || [],
        webSearch: agentConfig.webSearch || false,
        uiCustomization: agentConfig.uiCustomization
      }
    };

    return NextResponse.json(docs, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to generate docs' },
      { status: 500 }
    );
  }
}

