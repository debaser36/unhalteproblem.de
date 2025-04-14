interface VeryCoolButtonProps {
    color?: 'indigo' | 'blue' | 'red' | 'green' | 'purple' | 'gray';
    onClick?: () => void;
    icon?: React.ReactNode;
    buttonText?: string;
    extraClasses?: string;
    overrideClasses?: boolean
}

const generateClasses = (color: string, extraClasses: string, override: boolean = false) => {
    
    if(override) return extraClasses;
    return `
        flex
        absolute top-5 right-5 
        items-center 
        px-4 py-2 text-white 
        font-semibold rounded-lg 
        shadow-md transition duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 
        ease-in-out transform 
        hover:scale-90 
        ${color}-600 
        hover:bg-${color}-700
        bg-indigo-600 hover:bg-indigo-700'` + 
        ` ${extraClasses}
    `;
}


const VeryCoolButton = (props: VeryCoolButtonProps) => {
    const override = props.overrideClasses || false;
    const color = props.color || 'indigo';
    const extraClasses = props.extraClasses || '';
    return (
        <button
            onClick={props.onClick}
            className={generateClasses(color, extraClasses, override)} >
            {props.icon && <span className="mr-2">{props.icon}</span>}
            {props.buttonText || 'Very Cool Button'}
        </button>
    )
}

export default VeryCoolButton;