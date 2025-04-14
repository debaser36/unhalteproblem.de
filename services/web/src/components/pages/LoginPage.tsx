import { useState } from "react";
import  VeryCoolButton  from "../general/VeryCoolButton";
import { motion } from "framer-motion";
import { Lock, Mail } from "lucide-react";

export default function FancyLoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = () => {
    console.log("Logging in with:", email, password);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md"
      >
        <div className="rounded-2xl shadow-2xl bg-white/80 backdrop-blur-md">
          <div className="p-8">
            <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">
              Welcome Back
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 py-3 rounded-xl focus:ring-2 focus:ring-purple-500 w-full border border-gray-300 focus:outline-none"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 py-3 rounded-xl focus:ring-2 focus:ring-purple-500 w-full border border-gray-300 focus:outline-none"
                />
              </div>
              <VeryCoolButton
                onClick={handleLogin}
                color="indigo"
                buttonText="Login"
                overrideClasses={true}
                extraClasses="w-full py-3 mt-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-lg font-semibold shadow-lg transition-all duration-300"
              >
              </VeryCoolButton>
              <p className="text-center text-sm text-gray-600 mt-4">
                Don’t have an account? <a href="#" className="text-purple-600 hover:underline">Sign up</a>
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
