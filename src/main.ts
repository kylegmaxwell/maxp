const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Rough Mandelbrot set outline as circles in the complex plane: [re, im, radius]
const CIRCLES: ReadonlyArray<readonly [number, number, number]> = [
  [-0.25, 0, 0.5], // main cardioid
  [-1, 0, 0.25], // period-2 bulb
  [-1.31, 0, 0.06], // period-4 bulb
];

// Visible region of the complex plane
const CENTER_RE = -0.75;
const SPAN = 2.8; // units shown along the shorter canvas side

function draw(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const scale = Math.min(canvas.width, canvas.height) / SPAN;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(80, 160, 255, 0.5)';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;

  for (const [re, im, r] of CIRCLES) {
    const x = canvas.width / 2 + (re - CENTER_RE) * scale;
    const y = canvas.height / 2 - im * scale;
    ctx.beginPath();
    ctx.arc(x, y, r * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

window.addEventListener('resize', draw);
draw();
