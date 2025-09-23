import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import StoryMode from "./components/StoryMode.jsx";
import { ChakraProvider } from "@chakra-ui/react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";

// Wrapper component to pass userLanguage to StoryMode
function StoryModeWrapper() {
  const userLanguage = typeof window !== "undefined" 
    ? localStorage.getItem("appLanguage") || "en"
    : "en";
  
  return <StoryMode userLanguage={userLanguage} />;
}

createRoot(document.getElementById("root")).render(
  <ChakraProvider>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/story" element={<StoryModeWrapper />} />
        {/* <Route path="/experiments" element={<RealtimeAgent />} /> */}
      </Routes>
    </Router>
  </ChakraProvider>
);
