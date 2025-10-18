import { Link } from "react-router-dom";
import { SecureTerminal } from "@/components/SecureTerminal";

const Terminal = () => {
  return (
    <div className="h-screen bg-black">
      <SecureTerminal />
    </div>
  );
};

export default Terminal;
