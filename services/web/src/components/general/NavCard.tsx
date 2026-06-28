import React from 'react';

interface NavCardProps {
    title: string;
    desc: string;
}

const NavCard: React.FC<NavCardProps> = ({ title, desc }) => {
    return (
        <div className="p-5 rounded-xl bg-card hover:bg-card transition cursor-pointer border border-border hover:border-border">
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-foreground/60">{desc}</p>
        </div>
    );
};

export default NavCard;