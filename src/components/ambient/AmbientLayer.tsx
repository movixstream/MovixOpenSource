import { useEffect, useRef } from 'react';
import { AmbientEngine } from './ambientEngine';
import { AMBIENT_CLEAR_EVENT, AMBIENT_OPTIONS_EVENT, readAmbientOptions } from './ambientOptions';

/** Calque des effets d'ambiance : chargé à part, seulement quand ils sont activés. */
const AmbientLayer = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new AmbientEngine(canvas, readAmbientOptions());
    engine.start();
    const onOptions = () => engine.setOptions(readAmbientOptions());
    const onClear = () => engine.clear();
    window.addEventListener(AMBIENT_OPTIONS_EVENT, onOptions);
    window.addEventListener(AMBIENT_CLEAR_EVENT, onClear);
    return () => {
      window.removeEventListener(AMBIENT_OPTIONS_EVENT, onOptions);
      window.removeEventListener(AMBIENT_CLEAR_EVENT, onClear);
      engine.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-ambient-layer
      style={{ position: 'fixed', left: 0, top: 0, zIndex: 2147483647, pointerEvents: 'none' }}
    />
  );
};

export default AmbientLayer;
