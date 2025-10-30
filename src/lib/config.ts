export interface AgentConfig {
  name: string;
  systemPrompt: string;
  rules?: string[];
  tools: Array<{ id: string; name: string; description: string; enabled: boolean }>;
  webSearch: boolean;
  connectedApps: string[]; // Composio app keys
  mcps: Array<{ name: string; url: string; enabled: boolean }>;
  uiCustomization: {
    chatLayout: string;
    filesystemVisible: boolean;
    todoListVisible: boolean;
    toolCallsView: string;
    theme: string;
    primaryColor: string;
  };
}

export function getAgentConfig(): AgentConfig {
  const configJson = process.env.AGENT_CONFIG || '{}';
  try {
    const config = JSON.parse(configJson);
    return {
      name: config.name || 'AI Agent',
      systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
      rules: config.rules || [],
      tools: config.tools || [],
      webSearch: config.webSearch || false,
      connectedApps: config.connectedApps || [],
      mcps: config.mcps || [],
      uiCustomization: config.uiCustomization || {
        chatLayout: 'single',
        filesystemVisible: false,
        todoListVisible: false,
        toolCallsView: 'compact',
        theme: 'light',
        primaryColor: '#0084ff'
      }
    };
  } catch (error) {
    console.error('Error parsing AGENT_CONFIG:', error);
    return {
      name: 'AI Agent',
      systemPrompt: 'You are a helpful AI assistant.',
      rules: [],
      tools: [],
      webSearch: false,
      connectedApps: [],
      mcps: [],
      uiCustomization: {
        chatLayout: 'single',
        filesystemVisible: false,
        todoListVisible: false,
        toolCallsView: 'compact',
        theme: 'light',
        primaryColor: '#0084ff'
      }
    };
  }
}

