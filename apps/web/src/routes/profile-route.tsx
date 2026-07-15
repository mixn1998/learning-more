import { Navigate } from 'react-router-dom';

export function ProfileRoute() {
  return <Navigate replace to="/history?tab=portrait" />;
}
