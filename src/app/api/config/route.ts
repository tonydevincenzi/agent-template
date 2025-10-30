import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const agentConfig = JSON.parse(process.env.AGENT_CONFIG || '{}');
    
    return NextResponse.json({
      name: agentConfig.name || 'Agent',
      systemPrompt: agentConfig.systemPrompt || 'AI Assistant',
      model: agentConfig.model || 'claude-haiku-4-5-20251001',
      theme: agentConfig.uiCustomization?.theme || 'light',
      primaryColor: agentConfig.uiCustomization?.primaryColor || '#0084ff'
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load config' },
      { status: 500 }
    );
  }
}
