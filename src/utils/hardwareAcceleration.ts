/**
 * Utility to detect whether browser hardware acceleration is active.
 *
 * Browsers running with hardware acceleration disabled fall back to software
 * rasterization (e.g. SwiftShader, llvmpipe, WARP), which causes significant
 * performance degradation for complex 3D WebGL scenes.
 */

export interface HwAccelStatus {
  isHardwareAccelerated: boolean;
  rendererString?: string;
  vendorString?: string;
  details?: string;
}

export function detectHardwareAcceleration(): HwAccelStatus {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { isHardwareAccelerated: true };
  }

  // Developer simulation override via URL param: ?mock_no_hw_accel=true or window.__SIMULATE_NO_HW_ACCEL__
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mock_no_hw_accel') === 'true' || (window as any).__SIMULATE_NO_HW_ACCEL__ === true) {
      return {
        isHardwareAccelerated: false,
        rendererString: 'Simulated Software Rasterizer (SwiftShader / llvmpipe)',
        details: 'Simulated via mock_no_hw_accel parameter',
      };
    }
  } catch {
    // Ignore URL parse errors
  }

  try {
    // 1. Check standard WebGL context creation and extract unmasked renderer info
    const canvasStd = document.createElement('canvas');
    canvasStd.width = 1;
    canvasStd.height = 1;

    const glStd = (
      canvasStd.getContext('webgl2') ||
      canvasStd.getContext('webgl') ||
      canvasStd.getContext('experimental-webgl')
    ) as (WebGLRenderingContext | WebGL2RenderingContext | null);

    if (!glStd) {
      return {
        isHardwareAccelerated: false,
        details: 'WebGL is not supported or completely disabled.',
      };
    }

    let renderer = '';
    let vendor = '';
    try {
      const debugInfo = glStd.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        renderer = glStd.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        vendor = glStd.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
      }
      if (!renderer) {
        renderer = glStd.getParameter(glStd.RENDERER) || '';
      }
      if (!vendor) {
        vendor = glStd.getParameter(glStd.VENDOR) || '';
      }
    } catch {
      // Ignore extension query errors
    }

    // Release context
    try {
      glStd.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Ignore
    }

    // Check for known software rasterizers
    const lowerRenderer = renderer.toLowerCase();
    const isKnownSoftware =
      lowerRenderer.includes('swiftshader') ||
      lowerRenderer.includes('llvmpipe') ||
      lowerRenderer.includes('softpipe') ||
      lowerRenderer.includes('software rasterizer') ||
      lowerRenderer.includes('microsoft basic render') ||
      lowerRenderer.includes('warp');

    if (isKnownSoftware) {
      return {
        isHardwareAccelerated: false,
        rendererString: renderer,
        vendorString: vendor,
        details: `Software rasterizer detected: ${renderer}`,
      };
    }

    // 2. Try creating context with failIfMajorPerformanceCaveat: true
    // When hardware acceleration is disabled in browser settings, browsers enforce software
    // rendering which triggers failIfMajorPerformanceCaveat to return null.
    const canvasHw = document.createElement('canvas');
    canvasHw.width = 1;
    canvasHw.height = 1;

    let glHw: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    try {
      glHw = (
        canvasHw.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
        canvasHw.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ||
        canvasHw.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: true } as any)
      ) as (WebGLRenderingContext | WebGL2RenderingContext | null);
    } catch {
      glHw = null;
    }

    if (!glHw) {
      return {
        isHardwareAccelerated: false,
        rendererString: renderer,
        vendorString: vendor,
        details: 'Hardware acceleration disabled in browser settings (failIfMajorPerformanceCaveat triggered).',
      };
    }

    // Release context
    try {
      glHw.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Ignore
    }

    return {
      isHardwareAccelerated: true,
      rendererString: renderer,
      vendorString: vendor,
    };
  } catch (err) {
    console.warn('[HardwareAcceleration] Detection error:', err);
    // Return true on error to avoid false alarms
    return { isHardwareAccelerated: true };
  }
}
