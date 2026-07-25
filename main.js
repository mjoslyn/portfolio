// mark the chapter you're reading in the spine
(() => {
  const links = new Map(
    [...document.querySelectorAll(".spine nav a")].map((a) => [a.getAttribute("href").slice(1), a])
  );
  const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  let current = null;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) {
        if (current) current.removeAttribute("aria-current");
        current = links.get(e.target.id);
        if (current) current.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-15% 0px -70% 0px" }
  );
  sections.forEach((s) => io.observe(s));
})();
