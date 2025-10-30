import { NextResponse } from 'next/server';
import { getAgentConfig } from '@/lib/config';

export async function GET() {
  const config = getAgentConfig();
  return NextResponse.json(config);
}

