import { describe, expect, it } from 'vitest';
import { fitImageDimensions } from './mediaPipeline';

describe('dimensions des images normalisées', () => {
  it('conserve le ratio sans agrandir les petites images', () => {
    expect(fitImageDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('limite une image paysage à 3840 × 2160', () => {
    expect(fitImageDimensions(6000, 4000)).toEqual({ width: 3240, height: 2160 });
  });

  it('limite la largeur d’une image panoramique', () => {
    expect(fitImageDimensions(8000, 1000)).toEqual({ width: 3840, height: 480 });
  });

  it('refuse des dimensions source invalides', () => {
    expect(() => fitImageDimensions(0, 800)).toThrow('invalid_image_dimensions');
  });
});
