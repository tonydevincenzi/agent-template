# Agent Template

Universal runtime template for AgentHub deployed agents.

## Configuration

This app reads configuration from the `AGENT_CONFIG` environment variable (JSON).

### Example Configuration

```bash
export AGENT_CONFIG='{
  "name": "My Agent",
  "systemPrompt": "You are a helpful assistant.",
  "rules": ["Be concise", "Be friendly"],
  "tools": [],
  "webSearch": false,
  "connectedApps": ["github", "slack"],
  "mcps": [],
  "uiCustomization": {
    "theme": "light",
    "primaryColor": "#0084ff"
  }
}'
export ANTHROPIC_API_KEY="your_anthropic_key"
export COMPOSIO_API_KEY="your_composio_key"
```

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deployment

This template is designed to be deployed to Render with environment variables set automatically by AgentHub.

## License

MIT

