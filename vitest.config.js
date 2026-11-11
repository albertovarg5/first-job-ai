import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests (React Testing Library). The older server/UI tests keep
// running with `node --test`; these files end in .spec.jsx so they never mix.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', include: ['tests/ui/**/*.spec.jsx'], setupFiles: ['tests/ui/setup.js'], globals: true },
});
