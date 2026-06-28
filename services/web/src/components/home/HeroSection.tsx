import React from 'react';
import FadeIn from '../general/FadeIn';

const HeroSection: React.FC = () => {
    return (
        <div className="h-[60vh] flex items-center justify-center text-center px-6">
            <FadeIn>
                <div className="space-y-4">
                    <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
                        Nico Burkholder
                    </h1>

                    <p className="text-foreground/60 text-lg md:text-xl max-w-xl mx-auto">
                        Full-stack developer building fast, minimal, and scalable systems.
                    </p>

                    <p className="text-sm text-zinc-500">
                        React • TypeScript • Node • Systems Thinking
                    </p>
                </div>
            </FadeIn>
        </div>
    );
};

export default HeroSection;