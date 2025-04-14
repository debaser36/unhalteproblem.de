interface VeryCoolButtonProps {
    color?: 'indigo' | 'blue' | 'red' | 'green' | 'purple' | 'gray';
    onClick?: () => void;
    icon?: React.ReactNode;
    buttonText?: string;
    extraClasses?: string;
}

const VeryCoolButton = (props: VeryCoolButtonProps) => {
    return (
        <button
            onClick={props.onClick}
            className={
                `flex
                absolute top-5 right-5 
                items-center 
                px-4 py-2 text-white 
                font-semibold rounded-lg 
                shadow-md transition duration-200
                focus:outline-none focus:ring-2 focus:ring-offset-2 
                ease-in-out transform 
                hover:scale-90 
                ${props.color ? `bg-${props.color}-600 
                hover:bg-${props.color}-700` :
                 'bg-indigo-600 hover:bg-indigo-700'}`
                 + (props.extraClasses ? ` ${props.extraClasses}` : '')}
        >
            {props.icon && <span className="mr-2">{props.icon}</span>}
            {props.buttonText || 'Very Cool Button'}
        </button>
    )
}

export default VeryCoolButton;