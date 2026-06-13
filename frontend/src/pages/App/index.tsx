import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../../layouts/AppLayout";
import { AccountPage } from "../AccountPage";
import { OwnerPage } from "../OwnerPage";
import { SelectOrganizationPage } from "../SelectOrganizationPage";

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/owner" replace />} />
        <Route path="owner" element={<OwnerPage />} />
        <Route path="select-organization" element={<SelectOrganizationPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/owner" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
