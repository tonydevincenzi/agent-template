# Agent Template

This is the template used for all agent deployments created through the Agent Deploy platform.

## ⚠️ Important

**This directory is part of the [agent-deploy](https://github.com/tonydevincenzi/agent-deploy) platform repository.**

Changes made here are deployed to [agent-template](https://github.com/tonydevincenzi/agent-template) via the `deploy-template.sh` script.

## Development

**If you're working on the platform:**
- Make changes here in `/src/template`
- Test locally if needed: `cd src/template && npm install && npm run dev`
- Deploy to GitHub: `npm run deploy:template` (from root)
- All future agent deployments will use your changes

**If you're a user with a deployed agent:**
- You probably want to edit your agent config, not this template
- Update config via platform API or dashboard (no code changes needed)
- Config changes take effect in ~30 seconds without redeployment

## Architecture

This template includes:
- **Dynamic configuration loading** - fetches config from platform API at runtime
- **Claude Agent SDK integration** - streaming chat with tool use
- **Platform logging** - sessions and messages logged to platform database
- **Modern UI** - built with Next.js 15, React 19, Tailwind CSS

## Key Files

- `src/lib/config.ts` - Dynamic config loader (fetches from platform)
- `src/app/api/chat/route.ts` - Chat API with streaming support
- `src/components/chat/ChatInterface.tsx` - Main chat UI
- `src/lib/platformLogger.ts` - Logs to platform database

## Configuration

The template expects these environment variables:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_PLATFORM_API_URL=https://your-platform.com
NEXT_PUBLIC_DEPLOYMENT_ID=unique-deployment-id

# Optional
NODE_ENV=production
```

These are set automatically by the platform during deployment.

## What's Dynamic vs. Static

**Dynamic (loaded from API, updates without redeploy):**
- System prompt
- Model selection
- Agent rules
- Tool configurations
- UI theme and colors
- MCP configurations

**Static (requires redeploy to change):**
- API keys
- App structure
- Dependencies
- UI components
- API endpoints

## Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Run development server
npm run dev

# Visit http://localhost:3000
```

## Documentation

See the main platform repo for complete documentation:
- [TEMPLATE_ARCHITECTURE.md](../../TEMPLATE_ARCHITECTURE.md) - How the template system works
- [DYNAMIC_CONFIG.md](../../DYNAMIC_CONFIG.md) - Dynamic configuration guide

---

**Platform**: https://github.com/tonydevincenzi/agent-deploy  
**Last Updated**: October 31, 2025

