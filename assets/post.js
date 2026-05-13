const progress = document.querySelector(".reading-progress");
const copyButton = document.querySelector(".copy-link");
const backToTop = document.querySelector(".back-to-top");
let cardObserver;

function updateProgress() {
  if (!progress) return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const amount = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
  progress.style.transform = `scaleX(${amount})`;
  backToTop?.classList.toggle("visible", window.scrollY > 720);
}

window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", updateProgress);

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy link";
    }, 1800);
  } catch {
    copyButton.textContent = "Copy failed";
  }
});

backToTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function observeCards() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".post-card").forEach((card) => card.classList.add("visible"));
    return;
  }

  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      cardObserver.unobserve(entry.target);
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(".post-card").forEach((card, index) => {
    card.style.transitionDelay = `${Math.min(index, 6) * 45}ms`;
    cardObserver.observe(card);
  });
}

observeCards();
updateProgress();
