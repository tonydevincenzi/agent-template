import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Composio } from 'composio-core';
import { getAgentConfig } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const config = getAgentConfig();
    
    // Initialize Anthropic
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    
    // Initialize tools array
    const tools: any[] = [];
    
    // Initialize Composio with user's connected apps
    if (config.connectedApps?.length && process.env.COMPOSIO_API_KEY) {
      try {
        const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
        const composioTools = await composio.getTools({
          apps: config.connectedApps
        });
        tools.push(...composioTools);
      } catch (error) {
        console.error('Error loading Composio tools:', error);
      }
    }
    
    // Parse request body
    const { messages } = await request.json();
    
    // Build system prompt with rules
    let systemPrompt = config.systemPrompt;
    if (config.rules && config.rules.length > 0) {
      systemPrompt += '\n\nRules:\n' + config.rules.map(rule => `- ${rule}`).join('\n');
    }
    
    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages,
      tools: tools.length > 0 ? tools : undefined,
    });
    
    return NextResponse.json({
      message: response.content[0].type === 'text' ? response.content[0].text : '',
      response: response
    });
  } catch (error: any) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process request' },
      { status: 500 }
    );
  }
}

