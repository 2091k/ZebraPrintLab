import { describe, it, expect } from 'vitest';
import {
  normalizeHeaderForMatch,
  suggestCsvMapping,
  uniqueVariableName,
  nextFreeFnNumber,
  type Variable,
} from './Variable';

function v(name: string, id = name): Variable {
  return { id, name, fnNumber: 1, defaultValue: '' };
}

describe('normalizeHeaderForMatch', () => {
  it('lowercases and collapses spaces, dashes, underscores', () => {
    expect(normalizeHeaderForMatch('Product Code')).toBe('productcode');
    expect(normalizeHeaderForMatch('product_code')).toBe('productcode');
    expect(normalizeHeaderForMatch('Product-Code')).toBe('productcode');
    expect(normalizeHeaderForMatch('PRODUCT  CODE')).toBe('productcode');
  });

  it('leaves digits and other punctuation untouched', () => {
    expect(normalizeHeaderForMatch('SKU#1')).toBe('sku#1');
  });
});

describe('suggestCsvMapping', () => {
  it('matches variables to headers case- and whitespace-insensitively', () => {
    const variables = [v('sku'), v('productCode'), v('customer')];
    const headers = ['SKU', 'Product Code', 'Customer Name'];
    const result = suggestCsvMapping(variables, headers);
    expect(result).toEqual({
      sku: 'SKU',
      productCode: 'Product Code',
    });
    // 'customer' has no exact normalised match to 'Customer Name'.
    expect(result.customer).toBeUndefined();
  });

  it('consumes each header at most once (ties go to the first variable)', () => {
    const variables = [v('a', 'idA'), v('A', 'idA2')];
    const headers = ['a'];
    const result = suggestCsvMapping(variables, headers);
    expect(result).toEqual({ idA: 'a' });
  });

  it('returns empty object when nothing matches', () => {
    const variables = [v('sku')];
    const headers = ['totally-unrelated'];
    expect(suggestCsvMapping(variables, headers)).toEqual({});
  });

  it('returns empty object when no variables exist', () => {
    expect(suggestCsvMapping([], ['a', 'b'])).toEqual({});
  });
});

describe('uniqueVariableName + nextFreeFnNumber', () => {
  it('uniqueVariableName appends _2, _3 on collision', () => {
    const existing = [v('sku'), v('sku_2', 'x')];
    expect(uniqueVariableName('sku', existing)).toBe('sku_3');
  });

  it('nextFreeFnNumber returns 1 on empty set', () => {
    expect(nextFreeFnNumber([])).toBe(1);
  });

  it('nextFreeFnNumber skips taken slots', () => {
    expect(nextFreeFnNumber([1, 2, 4])).toBe(3);
  });

  it('nextFreeFnNumber returns null when 1-99 are all taken', () => {
    const all = Array.from({ length: 99 }, (_, i) => i + 1);
    expect(nextFreeFnNumber(all)).toBeNull();
  });
});
