import { NextRequest, NextResponse } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getAgentConfig } from '@/lib/config';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

export async function POST(request: NextRequest) {
  try {
    const config = getAgentConfig();
    
    // Check if API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      console.error('ANTHROPIC_API_KEY is not set or is empty in environment variables');
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured. Please check environment variables.' },
        { status: 500 }
      );
    }
    
    // Parse request body
    const { messages } = await request.json();
    
    // Get the last user message (the current prompt)
    const lastUserMessage = messages
      .filter((msg: any) => msg.role === 'user')
      .pop();
    
    if (!lastUserMessage) {
      return NextResponse.json(
        { error: 'No user message found in request' },
        { status: 400 }
      );
    }
    
    // Build system prompt with rules
    let systemPrompt = config.systemPrompt;
    if (config.rules && config.rules.length > 0) {
      systemPrompt += '\n\nRules:\n' + config.rules.map(rule => `- ${rule}`).join('\n');
    }
    
    // Build conversation context from previous messages
    // For the Agent SDK, we'll include conversation history in the prompt
    let conversationContext = '';
    if (messages.length > 1) {
      const previousMessages = messages.slice(0, -1);
      conversationContext = previousMessages
        .map((msg: any) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          return `${role}: ${msg.content}`;
        })
        .join('\n\n') + '\n\n';
    }
    
    // Combine conversation context with the current user message
    const fullPrompt = conversationContext + `User: ${lastUserMessage.content}`;
    
    // Build allowed tools list
    const allowedTools: string[] = [];
    
    // Add web search if enabled in config
    if (config.webSearch) {
      allowedTools.push('web_search');
    }
    
    // Add custom tools from config
    if (config.tools && config.tools.length > 0) {
      const customTools = config.tools
        .filter(tool => tool.enabled)
        .map(tool => tool.name);
      allowedTools.push(...customTools);
    }
    
    // Configure Agent SDK options
    const options: any = {
      systemPrompt,
      // Set allowed tools (only if we have any)
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
      // Configure MCP servers if provided
      mcpServers: config.mcps && config.mcps.length > 0
        ? config.mcps
            .filter(mcp => mcp.enabled)
            .reduce((acc: any, mcp) => {
              acc[mcp.name] = { type: 'http' as const, url: mcp.url };
              return acc;
            }, {})
        : undefined,
      // Set permission mode
      permissionMode: 'default',
    };
    
    // Create query with the full prompt
    const queryResult = query({
      prompt: fullPrompt,
      options,
    });
    
    // Collect all messages from the async generator
    let assistantMessage = '';
    let finalMessage: SDKAssistantMessage | null = null;
    
    for await (const message of queryResult) {
      if (message.type === 'assistant') {
        finalMessage = message as SDKAssistantMessage;
        // Extract text content from assistant message
        // The SDK message structure has message.content array
        if (finalMessage.message?.content && Array.isArray(finalMessage.message.content)) {
          const textParts = finalMessage.message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text || '');
          assistantMessage = textParts.join('');
        }
      } else if (message.type === 'partial_assistant') {
        // Handle streaming partial messages
        if (message.content && Array.isArray(message.content)) {
          const textParts = message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text || '');
          assistantMessage += textParts.join('');
        }
      }
    }
    
    // Return the final response
    return NextResponse.json({
      message: assistantMessage || '',
      response: finalMessage,
    });
  } catch (error: any) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process request' },
      { status: 500 }
    );
  }
}

