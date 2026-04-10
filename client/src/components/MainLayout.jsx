import { Outlet } from 'react-router-dom';
import ToastHost from './ToastHost';

export default function MainLayout() {
  return (
    <div className="main-layout-swipe">
      <Outlet />
      <ToastHost />
    </div>
  );
}
