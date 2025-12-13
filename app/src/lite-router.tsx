/* eslint-disable react-refresh/only-export-components */
import { FunctionalComponent, h } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import {
  Router as WouterRouter,
  Switch as WouterSwitch,
  Route as WouterRoute,
  Link as WouterLink,
  useLocation as useWouterLocation,
  useRoute as useWouterRoute,
} from "wouter-preact";

type PathParams = Record<string, string>;
const ParamsContext = createContext<PathParams>({});

type RouteProps = { path: string; element: preact.ComponentChild };

export const Route: FunctionalComponent<RouteProps> = ({ path, element }) => {
  const [match, params] = useWouterRoute<PathParams>(path);
  if (!match) return null;
  return <ParamsContext.Provider value={params}>{element}</ParamsContext.Provider>;
};

export const Routes: FunctionalComponent<{ children: preact.ComponentChildren }> = ({ children }) => (
  <WouterSwitch>{children}</WouterSwitch>
);

export const BrowserRouter: FunctionalComponent<{ basename?: string; children: preact.ComponentChildren }> = ({
  basename,
  children,
}) => <WouterRouter base={basename}>{children}</WouterRouter>;

export const Link = WouterLink as unknown as typeof import("react-router-dom").Link;

export const useNavigate = () => {
  const [, setLocation] = useWouterLocation();
  return (to: string) => setLocation(to);
};

export const useLocation = () => {
  const [location] = useWouterLocation();
  return { pathname: location };
};

export const useParams = <T extends PathParams = PathParams>(): T => useContext(ParamsContext) as T;

export const Navigate: FunctionalComponent<{ to: string }> = ({ to }) => {
  const navigate = useNavigate();
  navigate(to);
  return null;
};
