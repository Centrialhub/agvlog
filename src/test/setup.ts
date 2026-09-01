import "@testing-library/jest-dom";

if (typeof Element !== "undefined") {
  Object.defineProperties(Element.prototype, {
    hasPointerCapture: {
      configurable: true,
      writable: true,
      value: () => false,
    },
    releasePointerCapture: {
      configurable: true,
      writable: true,
      value: () => undefined,
    },
    setPointerCapture: {
      configurable: true,
      writable: true,
      value: () => undefined,
    },
    scrollIntoView: {
      configurable: true,
      writable: true,
      value: () => undefined,
    },
    scrollTo: {
      configurable: true,
      writable: true,
      value: () => undefined,
    },
  });
}

if (typeof window !== "undefined") {
  class TestPointerEvent extends Event {
    readonly height: number;
    readonly isPrimary: boolean;
    readonly pointerId: number;
    readonly pointerType: string;
    readonly pressure: number;
    readonly tangentialPressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly twist: number;
    readonly width: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.height = init.height ?? 1;
      this.isPrimary = init.isPrimary ?? true;
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.pressure = init.pressure ?? 0;
      this.tangentialPressure = init.tangentialPressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
      this.width = init.width ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList),
  });
}
