import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aggregate summary + the latest comments, read from Postgres. */
export async function GET() {
  const db = sql();
  const [summary] = (await db`
    SELECT count(*)::int AS count,
           coalesce(round(avg(rating)::numeric, 2), 0)::float AS average,
           coalesce(sum(case when on_chain then 1 else 0 end), 0)::int AS "onChain"
    FROM feedback
  `) as { count: number; average: number; onChain: number }[];

  const recent = await db`
    SELECT rating,
           comment,
           wallet,
           tx_hash AS "txHash",
           on_chain AS "onChain",
           created_at AS "createdAt"
    FROM feedback
    ORDER BY created_at DESC
    LIMIT 10
  `;

  return NextResponse.json({ ...summary, recent });
}

/** Record a piece of feedback. Off-chain by default; on-chain when a signed
 * `tx_hash` is supplied by the client after anchoring it to the contract. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const rating = Number(body.rating);
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  const wallet = typeof body.wallet === 'string' ? body.wallet : null;
  const txHash = typeof body.txHash === 'string' ? body.txHash : null;
  const onChain = Boolean(body.onChain && txHash);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be between 1 and 5.' }, { status: 400 });
  }
  if (!comment || comment.length > 280) {
    return NextResponse.json({ error: 'Comment must be 1–280 characters.' }, { status: 400 });
  }

  const db = sql();
  await db`
    INSERT INTO feedback (rating, comment, wallet, tx_hash, on_chain)
    VALUES (${rating}, ${comment}, ${wallet}, ${txHash}, ${onChain})
  `;

  return NextResponse.json({ ok: true });
}
