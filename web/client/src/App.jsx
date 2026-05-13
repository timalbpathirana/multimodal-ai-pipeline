import { Outlet, Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import AgentListPage from "./pages/AgentListPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import GlobalConfigPage from "./pages/GlobalConfigPage";
import InstructionsPage from "./pages/InstructionsPage";
import AboutPage from "./pages/AboutPage";

function AuthenticatedShell() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">
        Loading...
      </div>
    );
  }

  if (isError || !data) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthenticatedShell />}>
        <Route path="/" element={<AgentListPage />} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/config" element={<GlobalConfigPage />} />
        <Route path="/instructions" element={<InstructionsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
