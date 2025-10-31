// Dynamic configuration loader
// Config is fetched from the platform API at runtime, allowing changes without redeployment

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  model: string;
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
  deploymentId?: string;
  lastUpdated?: string;
}

// Cache configuration for performance
let cachedConfig: AgentConfig | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Fetches agent configuration from the platform API
 * Configuration is cached for 30 seconds for performance
 * Falls back to default config if platform is unavailable
 */
export async function getAgentConfig(): Promise<AgentConfig> {
  const now = Date.now();
  
  // Return cached config if still fresh
  if (cachedConfig && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedConfig;
  }
  
  const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  const deploymentId = process.env.NEXT_PUBLIC_DEPLOYMENT_ID;
  
  if (!platformUrl || !deploymentId) {
    console.warn('Platform URL or Deployment ID not configured. Using default config.');
    return getDefaultConfig();
  }
  
  try {
    const response = await fetch(`${platformUrl}/api/deployments/${deploymentId}/config`, {
      next: { revalidate: 30 }, // Next.js cache revalidation
    });
    
    if (!response.ok) {
      throw new Error(`Config API returned ${response.status}`);
    }
    
    const config = await response.json();
    cachedConfig = config;
    lastFetchTime = now;
    
    console.log('✅ Agent config loaded from platform');
    return config;
  } catch (error) {
    console.error('Failed to fetch agent config from platform:', error);
    
    // Fall back to cached config if available
    if (cachedConfig) {
      console.warn('⚠️ Using stale cached config');
      return cachedConfig;
    }
    
    // Last resort: use default config
    console.warn('⚠️ Using default config as fallback');
    return getDefaultConfig();
  }
}

/**
 * Returns default configuration as fallback
 * This ensures the agent works even if the platform API is unavailable
 */
function getDefaultConfig(): AgentConfig {
    return {
      name: 'AI Agent',
      systemPrompt: 'You are a helpful AI assistant.',
      model: 'claude-haiku-4-5-20251001',
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

