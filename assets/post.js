const progress = document.querySelector(".reading-progress");

function updateProgress() {
  if (!progress) return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const amount = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
  progress.style.transform = `scaleX(${amount})`;
}

window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", updateProgress);
updateProgress();
