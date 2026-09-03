import { describe, expect, it } from 'vitest';
import { applyTint, isRedLike, resolveColor } from '../../../xlsx/colors.ts';
import { classifyWeekFill, resolveVariantWeekType } from './week.ts';

describe('week colour semantics', () => {
  it('applies tint when resolving source colours', () => {
    expect(applyTint('000000', 0.5)).toBe('808080');
    expect(applyTint('FFFFFF', -0.5)).toBe('808080');
  });

  it('resolves RGB, theme and indexed colours', () => {
    expect(resolveColor({ type: 'rgb', rgb: 'FFDA9694' }, []).resolvedRgb).toBe(
      'DA9694',
    );
    expect(
      resolveColor({ type: 'theme', theme: 1 }, ['000000', 'C0504D'])
        .resolvedRgb,
    ).toBe('C0504D');
    expect(resolveColor({ type: 'indexed', indexed: 2 }, []).resolvedRgb).toBe(
      'FF0000',
    );
  });

  it('recognizes numerator red and rejects neutral colours', () => {
    expect(isRedLike('DA9694')).toBe(true);
    expect(isRedLike('C0504D')).toBe(true);
    expect(isRedLike('000000')).toBe(false);
    expect(isRedLike('FFFFFF')).toBe(false);
    expect(isRedLike('4F81BD')).toBe(false);
  });

  it('classifies numerator, neutral and unknown fills', () => {
    expect(classifyWeekFill(undefined)).toBe('neutral');
    expect(
      classifyWeekFill({
        patternType: 'solid',
        foreground: { type: 'theme', theme: 0, resolvedRgb: '000000' },
      }),
    ).toBe('neutral');
    expect(
      classifyWeekFill({
        patternType: 'solid',
        foreground: { type: 'rgb', rgb: 'FFDA9694', resolvedRgb: 'DA9694' },
      }),
    ).toBe('numerator');
    expect(
      classifyWeekFill({
        patternType: 'solid',
        foreground: { type: 'rgb', rgb: 'FF00FF00', resolvedRgb: '00FF00' },
      }),
    ).toBe('unknown');
  });

  it('resolves both week variants', () => {
    expect(resolveVariantWeekType(false, false, true, false)).toBe('both');
    expect(resolveVariantWeekType(false, false, false, true)).toBe(
      'denominator',
    );
    expect(resolveVariantWeekType(true, false, false, true)).toBe('numerator');
    expect(resolveVariantWeekType(false, true, false, true)).toBe('unknown');
  });
});
