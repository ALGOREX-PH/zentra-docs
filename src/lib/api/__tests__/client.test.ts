import { describe, it, expect } from 'vitest';
import { isApiErrorBody, readApiError } from '@/lib/api/client';

const JSON_HEADERS = { 'content-type': 'application/json' };
const FALLBACK = 'Something went wrong.';

describe('isApiErrorBody', () => {
  it('is true for a well-formed envelope', () => {
    expect(isApiErrorBody({ error: { code: 'x', message: 'y' } })).toBe(true);
  });

  it('is true for an envelope carrying details', () => {
    expect(
      isApiErrorBody({
        error: { code: 'validation_failed', message: 'Validation failed.', details: { rating: 'bad' } },
      }),
    ).toBe(true);
  });

  it('is false for null', () => {
    expect(isApiErrorBody(null)).toBe(false);
  });

  it('is false for an empty object', () => {
    expect(isApiErrorBody({})).toBe(false);
  });

  it('is false when error is a string', () => {
    expect(isApiErrorBody({ error: 'string' })).toBe(false);
  });

  it('is false when code is not a string', () => {
    expect(isApiErrorBody({ error: { code: 1, message: 'y' } })).toBe(false);
  });

  it('is false when message is missing', () => {
    expect(isApiErrorBody({ error: { code: 'x' } })).toBe(false);
  });

  it('is false for a plain string', () => {
    expect(isApiErrorBody('error')).toBe(false);
  });
});

describe('readApiError', () => {
  it('returns the message from a well-formed envelope', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'conflict', message: 'That hash was already submitted.' } }),
      { status: 409, headers: JSON_HEADERS },
    );

    expect(await readApiError(response, FALLBACK)).toBe('That hash was already submitted.');
  });

  it('appends every details value after the message', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'validation_failed',
          message: 'Validation failed.',
          details: {
            rating: 'Rating must be an integer between 1 and 5.',
            comment: 'Comment must be 1–280 characters.',
          },
        },
      }),
      { status: 422, headers: JSON_HEADERS },
    );

    const message = await readApiError(response, FALLBACK);

    expect(message).toBe(
      'Validation failed. Rating must be an integer between 1 and 5. Comment must be 1–280 characters.',
    );
    expect(message.startsWith('Validation failed.')).toBe(true);
    expect(message).toContain('Rating must be an integer between 1 and 5.');
    expect(message).toContain('Comment must be 1–280 characters.');
  });

  it('returns just the message when details is an empty object', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'internal', message: 'Internal server error.', details: {} } }),
      { status: 500, headers: JSON_HEADERS },
    );

    expect(await readApiError(response, FALLBACK)).toBe('Internal server error.');
  });

  it('falls back for a body that is not JSON', async () => {
    const response = new Response('not json at all', { status: 500 });
    expect(await readApiError(response, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for an empty body', async () => {
    const response = new Response('', { status: 500 });
    expect(await readApiError(response, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for an HTML error page', async () => {
    const response = new Response('<html>', { status: 502 });
    expect(await readApiError(response, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for JSON that is not the envelope', async () => {
    const response = new Response(JSON.stringify({ ok: false, reason: 'nope' }), {
      status: 500,
      headers: JSON_HEADERS,
    });

    expect(await readApiError(response, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for truncated JSON', async () => {
    const response = new Response('{"error":{"code":"internal",', {
      status: 500,
      headers: JSON_HEADERS,
    });

    expect(await readApiError(response, FALLBACK)).toBe(FALLBACK);
  });

  it('does not throw when the body stream fails', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const response = new Response(stream, { status: 500, headers: JSON_HEADERS });

    await expect(readApiError(response, FALLBACK)).resolves.toBe(FALLBACK);
  });
});
