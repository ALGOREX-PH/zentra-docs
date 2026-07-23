import { describe, it, expect } from 'vitest';
import {
  ABUSIVE_TERMS,
  moderateComment,
  normaliseForMatching,
} from '@/lib/api/moderation';

/** The shape of the abuse that reached production, kept verbatim as a fixture. */
const PRODUCTION_ABUSE = 'Gago ka talaga, bobo mong developer, wala kang alam.';

describe('moderateComment', () => {
  it('publishes an ordinary comment', () => {
    expect(moderateComment('Clean proof flow, the verifier felt fast.')).toEqual({
      publish: true,
      reason: 'clean',
    });
  });

  it('withholds the Tagalog abuse that reached production', () => {
    expect(moderateComment(PRODUCTION_ABUSE)).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('withholds English abuse', () => {
    expect(moderateComment('what a dickhead of a maintainer')).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('withholds a self-harm-directed phrase spanning two words', () => {
    expect(moderateComment('Just kill yourself already, nobody wants this')).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('withholds a Tagalog phrase spanning two words', () => {
    expect(moderateComment('Hayop ka, wala kang kwentang tao')).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('withholds more than two links', () => {
    expect(
      moderateComment('Buy here https://a.example and https://b.example and www.c.example'),
    ).toEqual({ publish: false, reason: 'excessive_links' });
  });

  it('withholds a repeated token', () => {
    expect(moderateComment('spam spam spam spam spam spam spam')).toEqual({
      publish: false,
      reason: 'repetition',
    });
  });

  it('withholds a mashed character run', () => {
    expect(moderateComment(`great${'!'.repeat(20)}`)).toEqual({
      publish: false,
      reason: 'repetition',
    });
  });

  it('withholds a long comment that is mostly uppercase', () => {
    expect(moderateComment('THIS WHOLE THING IS BROKEN AGAIN')).toEqual({
      publish: false,
      reason: 'shouting',
    });
  });

  it('catches leetspeak evasion', () => {
    expect(moderateComment('you are a g4g0 talaga')).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('catches diacritic evasion', () => {
    expect(moderateComment('gägö ka pare')).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('catches repeated-letter evasion', () => {
    expect(moderateComment('fuuuuuck this whole thing').reason).toBe('abusive_language');
    expect(moderateComment('ang boooboo mo talaga').reason).toBe('abusive_language');
  });

  it('catches mixed case', () => {
    expect(moderateComment('You are such a GaGo, seriously')).toEqual({
      publish: false,
      reason: 'abusive_language',
    });
  });

  it('matches terms only as whole words', () => {
    // Control: the bare terms really are live, so the misses below mean something.
    expect(moderateComment('you are an ass').publish).toBe(false);
    expect(moderateComment('what a cunt').publish).toBe(false);

    expect(moderateComment('We assess every proposal carefully.').publish).toBe(true);
    expect(moderateComment('The class diagram is clear.').publish).toBe(true);
    expect(moderateComment('Great analysis of the ledger data.').publish).toBe(true);
    expect(moderateComment('Shipped from Scunthorpe with no issues.').publish).toBe(true);
  });

  it('publishes a comment with exactly two links', () => {
    expect(moderateComment('Docs at https://a.example and mirror at www.b.example')).toEqual({
      publish: true,
      reason: 'clean',
    });
  });

  it('counts a www host inside an https URL as one link', () => {
    expect(
      moderateComment('See https://www.a.example and https://www.b.example for context'),
    ).toEqual({ publish: true, reason: 'clean' });
  });

  it('publishes a token repeated exactly six times', () => {
    expect(moderateComment('spam spam spam spam spam spam').publish).toBe(true);
  });

  it('publishes a character run of exactly fifteen', () => {
    expect(moderateComment(`great${'!'.repeat(15)}`).publish).toBe(true);
  });

  it('ignores the shouting rule for short comments', () => {
    expect(moderateComment('TOTALLY BROKEN')).toEqual({ publish: true, reason: 'clean' });
    expect(moderateComment('WOW')).toEqual({ publish: true, reason: 'clean' });
  });

  it('publishes a long comment that only shouts an acronym', () => {
    expect(moderateComment('The ZK proof in the SDK verified on the first try.').publish).toBe(
      true,
    );
  });

  it('reports abusive language ahead of the other reasons', () => {
    expect(moderateComment('GAGO KA https://a.example https://b.example https://c.example')).toEqual(
      { publish: false, reason: 'abusive_language' },
    );
  });

  it('reports excessive links ahead of shouting', () => {
    expect(
      moderateComment('LOOK HERE https://a.example https://b.example https://c.example'),
    ).toEqual({ publish: false, reason: 'excessive_links' });
  });

  it('treats empty and whitespace-only input as clean', () => {
    expect(moderateComment('')).toEqual({ publish: true, reason: 'clean' });
    expect(moderateComment('   \t \n ')).toEqual({ publish: true, reason: 'clean' });
  });
});

describe('normaliseForMatching', () => {
  it('lowercases', () => {
    expect(normaliseForMatching('ABC Def')).toBe('abc def');
  });

  it('strips diacritics', () => {
    expect(normaliseForMatching('Café Ñoño')).toBe('cafe nono');
  });

  it('maps leetspeak substitutions', () => {
    expect(normaliseForMatching('l33t h@x0r 5tuff 4nd 1t')).toBe('leet haxor stuff and it');
    expect(normaliseForMatching('ca$h')).toBe('cash');
  });

  it('collapses a run of three or more identical characters to two', () => {
    expect(normaliseForMatching('fuuuuck')).toBe('fuuck');
    expect(normaliseForMatching('aaa')).toBe('aa');
    expect(normaliseForMatching('aa')).toBe('aa');
    expect(normaliseForMatching('a')).toBe('a');
  });

  it('collapses whitespace and punctuation to single spaces', () => {
    expect(normaliseForMatching('  Hello,,,   world!! ')).toBe('hello world');
    expect(normaliseForMatching('one\t\ttwo\nthree')).toBe('one two three');
  });

  it('returns an empty string for empty and whitespace-only input', () => {
    expect(normaliseForMatching('')).toBe('');
    expect(normaliseForMatching('   ')).toBe('');
  });

  it('leaves an already normalised comment untouched', () => {
    expect(normaliseForMatching('the proof verified on chain')).toBe(
      'the proof verified on chain',
    );
  });
});

describe('ABUSIVE_TERMS', () => {
  it('stays lowercase, single-spaced and alphabetised so it is reviewable', () => {
    const terms = [...ABUSIVE_TERMS];
    expect(terms).toEqual([...terms].sort());
    for (const term of terms) {
      expect(term).toBe(term.toLowerCase());
      expect(term).toMatch(/^[a-z]+(?: [a-z]+)*$/);
    }
  });

  it('covers both languages the wall receives abuse in', () => {
    const terms: readonly string[] = ABUSIVE_TERMS;
    expect(terms).toContain('gago');
    expect(terms).toContain('bobo');
    expect(terms).toContain('kys');
  });

  it('survives normalisation, so every term can actually match', () => {
    for (const term of ABUSIVE_TERMS) {
      expect(normaliseForMatching(term)).toBe(term);
      expect(moderateComment(term).reason).toBe('abusive_language');
    }
  });
});
