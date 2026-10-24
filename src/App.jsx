import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import Landing from './pages/Landing.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ResumeBuilder from './pages/ResumeBuilder.jsx';
import JobTracker from './pages/JobTracker.jsx';
import JobSearch from './pages/JobSearch.jsx';
import InterviewPractice from './pages/InterviewPractice.jsx';
import ExperienceTranslator from './pages/ExperienceTranslator.jsx';
import CareerMissions from './pages/CareerMissions.jsx';
import Settings from './pages/Settings.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/resume" element={<ResumeBuilder />} />
        <Route path="/jobs" element={<JobSearch />} />
        <Route path="/tracker" element={<JobTracker />} />
        <Route path="/interview" element={<InterviewPractice />} />
        <Route path="/translator" element={<ExperienceTranslator />} />
        <Route path="/missions" element={<CareerMissions />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="/app" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
