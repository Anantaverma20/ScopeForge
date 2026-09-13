import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Workspace from "./pages/Workspace";
import Scenarios from "./pages/Scenarios";
import Experiments from "./pages/Experiments";
import Policies from "./pages/Policies";
import Playground from "./pages/Playground";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Workspace />} />
        <Route path="scenarios" element={<Scenarios />} />
        <Route path="experiments" element={<Experiments />} />
        <Route path="policies" element={<Policies />} />
        <Route path="playground" element={<Playground />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Workspace />} />
      </Route>
    </Routes>
  );
}
