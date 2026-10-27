import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import Landing from './pages/Landing.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ResumeBuilder from './pages/ResumeBuilder.jsx';
import JobTracker from './pages/JobTracker.jsx';
import ApplicationWorkspace from './pages/ApplicationWorkspace.jsx';
import JobSearch from './pages/JobSearch.jsx';
import CoverLetters from './pages/CoverLetters.jsx';
import CareerAssistant from './pages/CareerAssistant.jsx';
import InterviewPractice from './pages/InterviewPractice.jsx';
import ExperienceTranslator from './pages/ExperienceTranslator.jsx';
import CareerMissions from './pages/CareerMissions.jsx';
import Settings from './pages/Settings.jsx';
import { BillingCancel, BillingSuccess } from './pages/Billing.jsx';
import Pricing from './pages/Pricing.jsx';
import NotFound from './pages/NotFound.jsx';
import { ForgotPassword, ResetPassword, SignIn, SignUp, VerifyEmail } from './pages/Auth.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/resume" element={<ResumeBuilder />} />
        <Route path="/jobs" element={<JobSearch />} />
        <Route path="/tracker" element={<JobTracker />} />
        <Route path="/tracker/:id" element={<ApplicationWorkspace />} />
        <Route path="/cover-letters" element={<CoverLetters />} />
        <Route path="/interview" element={<InterviewPractice />} />
        <Route path="/assistant" element={<CareerAssistant />} />
        <Route path="/translator" element={<ExperienceTranslator />} />
        <Route path="/missions" element={<CareerMissions />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/billing/success" element={<BillingSuccess />} />
        <Route path="/billing/cancel" element={<BillingCancel />} />
      </Route>
      <Route path="/app" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
