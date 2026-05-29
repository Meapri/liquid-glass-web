export class LiquidInteractive {
  /**
   * Attach the pointer-following edge light (+ tilt) to every element matching
   * `selector` (default `.lg-interactive`). Returns the created instances.
   */
  static initAll(selector = '.lg-interactive'): LiquidInteractive[] {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
      (el) => new LiquidInteractive(el)
    );
  }

  private element: HTMLElement;
  private rafId: number | null = null;
  private isHovered = false;

  // Smoothing states for fluid motion
  private targetX = 0.5;
  private targetY = 0.5;
  private currentX = 0.5;
  private currentY = 0.5;

  constructor(element: HTMLElement) {
    this.element = element;
    
    // Bind events
    this.element.addEventListener('mousemove', this.onMouseMove);
    this.element.addEventListener('mouseenter', this.onMouseEnter);
    this.element.addEventListener('mouseleave', this.onMouseLeave);
    
    // Initialize CSS vars to center
    this.element.style.setProperty('--lg-pointer-x', '0.5');
    this.element.style.setProperty('--lg-pointer-y', '0.5');
    this.element.style.setProperty('--lg-tilt-x', '0deg');
    this.element.style.setProperty('--lg-tilt-y', '0deg');
  }

  private onMouseEnter = () => {
    this.isHovered = true;
    if (this.rafId === null) {
      this.loop();
    }
  };

  private onMouseLeave = () => {
    this.isHovered = false;
    // Return to center
    this.targetX = 0.5;
    this.targetY = 0.5;
    
    // The loop will automatically clear when current matches target and isHovered is false
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isHovered) return;
    const rect = this.element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Normalized coordinates from 0.0 to 1.0
    this.targetX = x / rect.width;
    this.targetY = y / rect.height;
  };

  private loop = () => {
    // Lerp towards target for fluid, non-jittery movement
    this.currentX += (this.targetX - this.currentX) * 0.15;
    this.currentY += (this.targetY - this.currentY) * 0.15;

    // Pointer position vars are owned by the core PointerField; here we only
    // drive the 3D parallax tilt from the hover position.
    // Map normalized [0, 1] to tilt [-10deg, 10deg]
    // If mouse is at top (y=0), element tilts up (rotateX positive)
    const tiltX = (0.5 - this.currentY) * 20; 
    const tiltY = (this.currentX - 0.5) * 20; 
    
    this.element.style.setProperty('--lg-tilt-x', `${tiltX.toFixed(2)}deg`);
    this.element.style.setProperty('--lg-tilt-y', `${tiltY.toFixed(2)}deg`);

    // Stop looping if resting
    if (!this.isHovered && Math.abs(this.targetX - this.currentX) < 0.001 && Math.abs(this.targetY - this.currentY) < 0.001) {
      this.rafId = null;
      // Reset precisely to center to avoid floating point issues
      this.element.style.setProperty('--lg-tilt-x', '0deg');
      this.element.style.setProperty('--lg-tilt-y', '0deg');
      return;
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  public destroy() {
    this.element.removeEventListener('mousemove', this.onMouseMove);
    this.element.removeEventListener('mouseenter', this.onMouseEnter);
    this.element.removeEventListener('mouseleave', this.onMouseLeave);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
  }
}
