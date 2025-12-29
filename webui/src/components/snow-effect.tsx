import { useEffect, useRef, useState, createContext, useContext } from "react";

type SnowContextType = {
  snowEnabled: boolean;
  setSnowEnabled: (enabled: boolean) => void;
};

const SnowContext = createContext<SnowContextType | null>(null);

export function useSnow() {
  const context = useContext(SnowContext);
  if (!context) {
    throw new Error("useSnow must be used within a SnowProvider");
  }
  return context;
}

export function SnowProvider({ children }: { children: React.ReactNode }) {
  const [snowEnabled, setSnowEnabled] = useState(() => {
    const saved = localStorage.getItem("snowEnabled");
    return saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("snowEnabled", String(snowEnabled));
  }, [snowEnabled]);

  return (
    <SnowContext.Provider value={{ snowEnabled, setSnowEnabled }}>
      {children}
      {snowEnabled && <SnowCanvas />}
    </SnowContext.Provider>
  );
}

interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  wind: number;
  opacity: number;
}

function SnowCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snowflakesRef = useRef<Snowflake[]>([]);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // 初始化雪花
    const snowflakeCount = Math.floor((window.innerWidth * window.innerHeight) / 15000 * 1.3);
    snowflakesRef.current = Array.from({ length: snowflakeCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 3 + 1,
      speed: Math.random() * 1 + 0.5,
      wind: Math.random() * 0.5 - 0.25,
      opacity: Math.random() * 0.5 + 0.3,
    }));

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      snowflakesRef.current.forEach((flake) => {
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
        ctx.fill();

        // 更新位置
        flake.y += flake.speed;
        flake.x += flake.wind + Math.sin(flake.y * 0.01) * 0.3;

        // 重置到顶部
        if (flake.y > canvas.height) {
          flake.y = -flake.radius;
          flake.x = Math.random() * canvas.width;
        }
        if (flake.x > canvas.width) {
          flake.x = 0;
        } else if (flake.x < 0) {
          flake.x = canvas.width;
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
      style={{ background: "transparent" }}
    />
  );
}
