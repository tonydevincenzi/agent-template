import { NextResponse } from 'next/server';
import { getAgentConfig } from '@/lib/config';

export async function GET() {
  try {
    const config = await getAgentConfig();
    
    console.log('[Config API] Returning config:', { 
      name: config.agent.name, 
      hasSystemPrompt: !!config.agent.systemPrompt,
      source: config.deploymentId ? 'platform' : 'fallback'
    });
    
    return NextResponse.json({
      name: config.agent.name,
      systemPrompt: config.agent.systemPrompt,
      model: config.agent.model,
      rules: config.agent.rules || [],
      tools: config.services.tools || [],
      webSearch: config.services.webSearch,
      connectedApps: config.services.connectedApps || [],
      mcps: config.services.mcps || [],
      uiCustomization: config.uiCustomization,
      // Add metadata for debugging
      _debug: {
        deploymentId: config.deploymentId || null,
        lastUpdated: config.lastUpdated || null,
        envVars: {
          platformUrl: process.env.NEXT_PUBLIC_PLATFORM_API_URL || null,
          deploymentId: process.env.NEXT_PUBLIC_DEPLOYMENT_ID || null,
        }
      }
    });
  } catch (error) {
    console.error('[Config API] Error loading config:', error);
    return NextResponse.json(
      { error: 'Failed to load config', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
