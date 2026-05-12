import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import LoginPage from "./pages/LoginPage";
import AgentListPage from "./pages/AgentListPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import GlobalConfigPage from "./pages/GlobalConfigPage";

function RequireAuth({ children }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
  });
  if (isLoading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (isError || !data) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><AgentListPage /></RequireAuth>} />
      <Route path="/agents/:id" element={<RequireAuth><AgentDetailPage /></RequireAuth>} />
      <Route path="/config" element={<RequireAuth><GlobalConfigPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
