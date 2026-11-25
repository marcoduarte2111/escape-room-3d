// Infiere cómo suele actuar el jugador a partir de las últimas rondas.
function createNpcAI(random = Math.random) {
  const memory = [];
  const outlook = (random() - 0.5) * 0.24;
  return {
    choose(base, gas) {
      const pressure = Math.min(0.57, Math.max(0, gas - 85) / 290);
      // Dos observaciones previas neutras amortiguan las primeras rondas.
      const trust = (1 + memory.filter(Boolean).length) / (2 + memory.length);
      const probability = Math.max(0.08, Math.min(0.94, base + outlook - pressure + (trust - 0.5) * 0.58));
      return random() < probability ? 'COOPERAR' : 'COMPETIR';
    },
    observe(action) {
      memory.push(action === 'COOPERAR');
      if (memory.length > 5) memory.shift();
    }
  };
}
