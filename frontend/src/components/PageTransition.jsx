import { useRef, useEffect } from 'react';

export function PageTransition({ children, className = '' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.opacity = '0';
      containerRef.current.style.transform = 'translateY(10px)';
      
      requestAnimationFrame(() => {
        containerRef.current.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        containerRef.current.style.opacity = '1';
        containerRef.current.style.transform = 'translateY(0)';
      });
    }
  }, [children]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
