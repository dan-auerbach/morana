import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { listVoices } from "@/lib/providers/tts";

export async function GET() {
  return withAuth(async () => {
    const voices = await listVoices();
    return NextResponse.json({ voices });
  });
}
