import React from 'react';
import HeroSection from '../home/HeroSection';
import VeryCoolButton from '../general/VeryCoolButton';
import ProjectCard from '../home/ProjectCard';
import NavCard from '../general/NavCard';

const HomePage: React.FC = () => {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            
            <HeroSection />

            <main className="flex-1 px-6 md:px-12 lg:px-24 py-12 space-y-16">

                {/* Quick Navigation */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <NavCard title="WIP" desc="Work in Progress" />
                    <NavCard title="WIP" desc="Work in Progress" />
                    <NavCard title="WIP" desc="Work in progress" />
                </section>

                {/* Featured Work */}
                <section className="space-y-2">
                    <h2 className="text-xl font-semibold text-foreground/80">
                        Featured Work
                    </h2>

                    <div className="grid md:grid-cols-2 gap-4">
                        <ProjectCard
                            name="Web Platform (this Website)"
                            desc="Full-stack React + API system"
                            tags={['React', 'TS', 'API', 'Effect TS']}
                        />
                    </div>
                </section>

                {/* Action */}
                <section className="flex justify-center">
                    <VeryCoolButton
                        color="indigo"
                        buttonText="View GitHub"
                        onClick={() => window.open('https://github.com/debaser36', '_blank')}
                    />
                </section>

            </main>
        </div>
    );
};

export default HomePage;