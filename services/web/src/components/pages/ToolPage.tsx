import { Link } from "react-router-dom";
import  VeryCoolButton  from "../general/VeryCoolButton";
import {AppleIcon} from "lucide-react"

export default function ToolPage() {

  return (
    <Link to="/tools/kiwiCalc" >
        <VeryCoolButton buttonText="Kiwi Calculator" color="red" extraClasses="" icon={<AppleIcon/>} ></VeryCoolButton>
    </Link>
  );
}
