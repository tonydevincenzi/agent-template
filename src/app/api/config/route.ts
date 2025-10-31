import { NextResponse } from 'next/server';
import { getAgentConfig } from '@/lib/config';

export async function GET() {
  try {
    const config = await getAgentConfig();
    
    return NextResponse.json({
      name: config.name || 'Agent',
      systemPrompt: config.systemPrompt || 'AI Assistant',
      model: config.model || 'claude-haiku-4-5-20251001',
      rules: config.rules || [],
      tools: config.tools || [],
      webSearch: config.webSearch || false,
      connectedApps: config.connectedApps || [],
      mcps: config.mcps || [],
      uiCustomization: config.uiCustomization || {
        theme: 'light',
        primaryColor: '#0084ff',
        todoListVisible: false,
        filesystemVisible: false,
        chatLayout: 'single',
        toolCallsView: 'compact'
      }
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load config' },
      { status: 500 }
    );
  }
}
