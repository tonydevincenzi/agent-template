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
    
    // Add custom tools from config
    if (config.tools && config.tools.length > 0) {
      const customTools = config.tools
        .filter(tool => tool.enabled)
        .map(tool => tool.name);
      allowedTools.push(...customTools);
    }
    
    // Build tools array for Agent SDK
    const tools: any[] = [];
    
    // Add web search tool if enabled
    if (config.webSearch) {
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5, // Limit to 5 searches per request
      });
    }
    
    // Log configuration for debugging
    console.log(`[Agent Config] webSearch: ${config.webSearch}, tools: ${tools.length}, allowedTools: ${allowedTools.join(', ')}`);
    
    // Configure Agent SDK options
    const options: any = {
      systemPrompt,
      // Include web search tool in tools array if enabled
      tools: tools.length > 0 ? tools : undefined,
      // Set allowed tools only if we have custom tools AND web search is disabled
      // If web search is enabled, don't restrict allowedTools to allow built-in tools
      allowedTools: (!config.webSearch && allowedTools.length > 0) ? allowedTools : undefined,
      // Configure MCP servers if provided
      mcpServers: config.mcps && config.mcps.length > 0
        ? config.mcps
            .filter(mcp => mcp.enabled)
            .reduce((acc: any, mcp) => {
              acc[mcp.name] = { type: 'http' as const, url: mcp.url };
              return acc;
            }, {})
        : undefined,
      // Set permission mode - use 'bypassPermissions' if web search is enabled to allow tool usage
      permissionMode: config.webSearch ? 'bypassPermissions' : 'default',
      // Explicitly allow web search tool if enabled - handle all possible tool name variations
      canUseTool: config.webSearch
        ? async (toolName: string, input: any) => {
            console.log(`[canUseTool] Tool requested: ${toolName}`);
            // Allow web search tool variations when enabled
            const webSearchVariants = [
              'web_search',
              'web_search_20250305',
              'WebSearch',
              'webSearch',
              'web-search',
              'websearch'
            ];
            const normalizedToolName = toolName.toLowerCase().replace(/[-_]/g, '');
            const isWebSearch = webSearchVariants.some(variant => 
              variant.toLowerCase().replace(/[-_]/g, '') === normalizedToolName
            );
            
            if (isWebSearch) {
              console.log(`[canUseTool] Allowing web search tool: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input };
            }
            // Allow other tools from config
            if (allowedTools.includes(toolName)) {
              console.log(`[canUseTool] Allowing configured tool: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input };
            }
            // For bypassPermissions mode, allow all other tools too
            if (config.webSearch) {
              console.log(`[canUseTool] Allowing tool in bypassPermissions mode: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input };
            }
            // Deny by default for unknown tools
            console.log(`[canUseTool] Denying unknown tool: ${toolName}`);
            return { behavior: 'deny' as const, message: `Tool ${toolName} is not permitted` };
          }
        : undefined,
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
      } else if (message.type === 'stream_event') {
        // Handle streaming partial messages
        const streamMsg = message as any;
        if (streamMsg.event?.delta?.type === 'text_delta' && streamMsg.event.delta.text) {
          assistantMessage += streamMsg.event.delta.text;
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

