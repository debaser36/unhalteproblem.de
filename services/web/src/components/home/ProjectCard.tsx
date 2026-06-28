import React from 'react';

interface ProjectCardProps {
    name: string;
    desc: string;
    tags?: string[];
}

const ProjectCard: React.FC<ProjectCardProps> = ({ name, desc, tags = [] }) => {
    return (
        <div className="p-5 rounded-xl bg-card border border-border hover:border-border transition">
            <h3 className="text-lg font-semibold">{name}</h3>
            <p className="text-sm text-foreground/60 mt-1">{desc}</p>

            <div className="flex flex-wrap gap-2 mt-3">
                {tags.map(tag => (
                    <span
                        key={tag}
                        className="text-xs px-2 py-1 bg-card rounded-md text-foreground/80"
                    >
                        {tag}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default ProjectCard;