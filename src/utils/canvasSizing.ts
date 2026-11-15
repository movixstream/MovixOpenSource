const MAX_CANVAS_DIMENSION = 4096;
const MAX_CANVAS_AREA = 8_388_608;

export interface CanvasBitmapSize {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Calcule un backing store borné tout en conservant la taille CSS demandée.
 * Les limites choisies restent compatibles avec les anciens moteurs Safari
 * et évitent qu'une mesure de layout aberrante invalide le contexte Firefox.
 */
export const fitCanvasBitmapSize = (
  cssWidth: number,
  cssHeight: number,
  preferredScale = 1,
): CanvasBitmapSize | null => {
  if (
    !Number.isFinite(cssWidth)
    || !Number.isFinite(cssHeight)
    || !Number.isFinite(preferredScale)
    || cssWidth <= 0
    || cssHeight <= 0
    || preferredScale <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    preferredScale,
    MAX_CANVAS_DIMENSION / cssWidth,
    MAX_CANVAS_DIMENSION / cssHeight,
    Math.sqrt(MAX_CANVAS_AREA / (cssWidth * cssHeight)),
  );
  const width = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.floor(cssWidth * scale)));
  const height = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.floor(cssHeight * scale)));

  return {
    width,
    height,
    scaleX: width / cssWidth,
    scaleY: height / cssHeight,
  };
};

export const isCanvasInvalidStateError = (error: unknown): boolean => (
  typeof DOMException !== 'undefined'
  && error instanceof DOMException
  && error.name === 'InvalidStateError'
);
